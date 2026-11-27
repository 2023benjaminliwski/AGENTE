document.addEventListener("DOMContentLoaded", () => {
  // Referencias a los elementos del DOM
  const zonaChat = document.getElementById("zona-chat");
  const chatForm = document.getElementById("chat-form");
  const userInput = document.getElementById("user-input");
  const sendBtn = document.getElementById("send-btn");

  if (!zonaChat || !chatForm || !userInput || !sendBtn) {
    console.error("Faltan elementos del HTML. Revisá los IDs en index.html.");
    return;
  }

  // Variables de estado y constantes
  let isWaiting = false;
  let sessionIdMemoria = "";
  const TIMEOUT_MS = 30000;
  const COOLDOWN_MS = 1500;
  const MAX_CARACTERES = 500;
  const CLAVE_SESION = "promptin_session_id";

  // Genera o recupera un identificador único de sesión
  function obtenerSessionId() {
    try {
      const guardado = localStorage.getItem(CLAVE_SESION);
      if (guardado) return guardado;
    } catch (e) {
      if (sessionIdMemoria) return sessionIdMemoria;
    }

    const nuevoId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `ses-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    try {
      localStorage.setItem(CLAVE_SESION, nuevoId);
    } catch (e) {
      sessionIdMemoria = nuevoId;
    }

    return nuevoId;
  }

  const sessionId = obtenerSessionId();

  // Verifica si la URL del webhook está configurada
  function webhookConfigurado() {
    if (typeof WEBHOOK_URL !== "string") return false;
    const url = WEBHOOK_URL.trim();
    if (!url) return false;
    if (url.includes("ACA VA") || url.includes("ejemplo-webhook-prueba")) return false;
    return true;
  }

  // Limpia envoltorios Markdown como ```json y ```
  function limpiarMarkdown(texto) {
    return texto
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  // Busca la primera propiedad de texto válida en un objeto
  function extraerCampoRespuesta(obj) {
    const claves = ["response", "respuesta", "message", "mensaje"];
    for (const clave of claves) {
      if (typeof obj[clave] === "string" && obj[clave].trim() !== "") {
        return obj[clave];
      }
    }
    return null;
  }

  // Extrae valor de texto por expresión regular si el JSON viene mal escapado
  function extraerPorRegex(texto) {
    const claves = ["response", "respuesta", "message", "mensaje"];
    for (const clave of claves) {
      const regex = new RegExp(`"${clave}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\})`);
      const coincidencia = texto.match(regex);
      if (coincidencia && coincidencia[1].trim() !== "") {
        return coincidencia[1]
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"');
      }
    }
    return null;
  }

  // Analiza la respuesta de Make de forma tolerante a errores de formato
  function procesarRespuestaMake(textoCrudo) {
    if (!textoCrudo) return "(respuesta vacía)";

    const limpio = limpiarMarkdown(textoCrudo);
    if (!limpio) return "(respuesta vacía)";

    const pareceObjeto = limpio.startsWith("{") && limpio.endsWith("}");

    try {
      const datos = JSON.parse(limpio);
      if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
        const campo = extraerCampoRespuesta(datos);
        return campo !== null ? campo : "Make respondió, pero sin el campo response";
      }
      return limpio;
    } catch (e) {
      if (!pareceObjeto) return limpio;

      try {
        const reparado = limpio.replace(/\r?\n/g, "\\n");
        const datosReparados = JSON.parse(reparado);
        if (datosReparados !== null && typeof datosReparados === "object" && !Array.isArray(datosReparados)) {
          const campo = extraerCampoRespuesta(datosReparados);
          return campo !== null ? campo : "Make respondió, pero sin el campo response";
        }
      } catch (e2) {
        const porRegex = extraerPorRegex(limpio);
        if (porRegex !== null) return porRegex;
      }

      return "Make respondió, pero sin el campo response";
    }
  }

  // Función central para validar y procesar el envío
  async function manejarEnvio() {
    const message = userInput.value.trim();

    if (!message || isWaiting) return;

    if (message.length > MAX_CARACTERES) {
      appendMessage("agent", `El mensaje no puede superar los ${MAX_CARACTERES} caracteres.`, true);
      return;
    }

    if (!webhookConfigurado()) {
      appendMessage("agent", "Falta pegar la URL de tu webhook en config.js", true);
      return;
    }

    // Renderizar el mensaje del usuario en la ZONA CHAT
    appendMessage("user", message);
    userInput.value = "";

    // Enviar mensaje al agente
    await sendMessageToAgent(message);
  }

  // Event Listener para el botón de enviar
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await manejarEnvio();
  });

  // Permite enviar directamente con la tecla Enter sin Shift+Enter
  userInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await manejarEnvio();
    }
  });

  // Función para enviar la consulta al Webhook
  async function sendMessageToAgent(mensaje) {
    setLoadingState(true);
    const loadingElement = appendLoadingIndicator();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const fecha = new Date().toISOString();
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, mensaje, fecha }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const rawText = (await response.text()).trim();

      if (!response.ok) {
        loadingElement.remove();
        appendMessage(
          "agent",
          `Make respondió con error (código ${response.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
          true
        );
        return;
      }

      const textoFinal = procesarRespuestaMake(rawText);
      loadingElement.remove();
      appendMessage("agent", textoFinal);

    } catch (error) {
      clearTimeout(timeoutId);
      loadingElement.remove();

      let errorMessage = "Error de red: no se pudo conectar con Make. Revisá tu conexión a internet.";
      if (error.name === "AbortError") {
        errorMessage = "Tiempo agotado: Make tardó más de 30 segundos en responder. Intentá de nuevo.";
      }

      appendMessage("agent", errorMessage, true);
    } finally {
      setTimeout(() => {
        setLoadingState(false);
      }, COOLDOWN_MS);
    }
  }

  // Función auxiliar para agregar burbujas al DOM en la ZONA CHAT
  function appendMessage(sender, text, isError = false) {
    const messageArticle = document.createElement("article");
    messageArticle.classList.add("message", `${sender}-message`);
    if (isError) messageArticle.classList.add("error");

    const avatarDiv = document.createElement("div");
    avatarDiv.classList.add("avatar");
    avatarDiv.textContent = sender === "user" ? "👤" : "🤖";

    const bubbleDiv = document.createElement("div");
    bubbleDiv.classList.add("bubble");
    bubbleDiv.textContent = text;

    messageArticle.appendChild(avatarDiv);
    messageArticle.appendChild(bubbleDiv);

    zonaChat.appendChild(messageArticle);
    scrollToBottom();
  }

  // Función auxiliar para mostrar los puntos de carga sin usar innerHTML
  function appendLoadingIndicator() {
    const loadingArticle = document.createElement("article");
    loadingArticle.classList.add("message", "agent-message");

    const avatarDiv = document.createElement("div");
    avatarDiv.classList.add("avatar");
    avatarDiv.textContent = "🤖";

    const bubbleDiv = document.createElement("div");
    bubbleDiv.classList.add("bubble");

    const dotsDiv = document.createElement("div");
    dotsDiv.classList.add("loading-dots");

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.classList.add("dot");
      dotsDiv.appendChild(dot);
    }

    bubbleDiv.appendChild(dotsDiv);
    loadingArticle.appendChild(avatarDiv);
    loadingArticle.appendChild(bubbleDiv);

    zonaChat.appendChild(loadingArticle);
    scrollToBottom();
    return loadingArticle;
  }

  // Control del estado del botón y campo de texto
  function setLoadingState(loading) {
    isWaiting = loading;
    sendBtn.disabled = loading;
    userInput.disabled = loading;
    if (!loading) {
      userInput.focus();
    }
  }

  // Auto-scroll al final del historial de chat
  function scrollToBottom() {
    zonaChat.scrollTop = zonaChat.scrollHeight;
  }
});
