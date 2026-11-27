// Referencias a los elementos del DOM respetando las zonas indicadas
const zonaChat = document.getElementById("zona-chat");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

// Constantes de configuración y límites
let isWaiting = false;
const TIMEOUT_MS = 30000; // Límite de 30 segundos
const COOLDOWN_MS = 1500; // Pausa mínima de 1,5 segundos entre envíos
const MAX_CHARS = 500; // Límite de caracteres por mensaje

// Inicialización del identificador de sesión único
const sessionId = obtenerSessionId();

function obtenerSessionId() {
  const claveStorage = "promptin_session_id";
  let idGuardado = null;

  try {
    idGuardado = localStorage.getItem(claveStorage);
  } catch (e) {
    // Si localStorage está bloqueado, se usará memoria
  }

  if (idGuardado) return idGuardado;

  const nuevoId = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (e) {
    // Continuar usando el ID en memoria
  }

  return nuevoId;
}

// Asegurar límite de caracteres en el HTML
if (userInput) {
  userInput.setAttribute("maxlength", MAX_CHARS);
}

// Event Listener para el formulario de envío
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = userInput.value.trim();

  if (!message || isWaiting) return;

  if (message.length > MAX_CHARS) {
    appendMessage("agent", `El mensaje no puede superar los ${MAX_CHARS} caracteres.`, true);
    return;
  }

  // Verificar si WEBHOOK_URL está configurada correctamente
  if (!esUrlValida()) {
    appendMessage("agent", "Falta pegar la URL de tu webhook en config.js", true);
    return;
  }

  // Renderizar el mensaje del usuario en la ZONA CHAT
  appendMessage("user", message);
  userInput.value = "";

  // Enviar mensaje al agente
  await sendMessageToAgent(message);
});

// Permite enviar con la tecla Enter sin Shift+Enter
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

// Verifica que la constante WEBHOOK_URL exista y no tenga valores de ejemplo
function esUrlValida() {
  if (typeof WEBHOOK_URL === "undefined" || !WEBHOOK_URL) return false;
  const url = String(WEBHOOK_URL).trim();
  if (url === "" || url.includes("ACA VA") || url.includes("ejemplo-webhook-prueba")) {
    return false;
  }
  return true;
}

// Función para enviar la consulta al Webhook con protección y manejo asíncrono
async function sendMessageToAgent(mensaje) {
  setLoadingState(true);
  const loadingElement = appendLoadingIndicator();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const payload = {
    sessionId: sessionId,
    mensaje: mensaje,
    fecha: new Date().toISOString()
  };

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!respuesta.ok) {
      loadingElement.remove();
      appendMessage(
        "agent",
        `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
        true
      );
      return;
    }

    const textoCrudo = (await respuesta.text()).trim();
    loadingElement.remove();

    if (!textoCrudo) {
      appendMessage("agent", "(respuesta vacía)");
      return;
    }

    const textoFinal = procesarRespuestaMake(textoCrudo);
    appendMessage("agent", textoFinal);

  } catch (error) {
    clearTimeout(timeoutId);
    loadingElement.remove();

    let errorMessage = "Error de red al conectar con Make. Verificá tu conexión a internet.";
    if (error.name === "AbortError") {
      errorMessage = "Tiempo agotado: Make tardó más de 30 segundos en responder.";
    }

    appendMessage("agent", errorMessage, true);
  } finally {
    // Garantiza que nunca quede bloqueado tras la pausa mínima
    setTimeout(() => {
      setLoadingState(false);
    }, COOLDOWN_MS);
  }
}

// Limpia bloques Markdown y extrae la respuesta de forma tolerante a errores de formato
function procesarRespuestaMake(texto) {
  // Quitar envoltorios ```json ... ``` o ``` ... ```
  let limpio = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Verificar si parece un objeto JSON
  if (limpio.startsWith("{") && limpio.endsWith("}")) {
    let objeto = intentarParsearJson(limpio);

    if (objeto && typeof objeto === "object" && !Array.isArray(objeto)) {
      const campos = ["response", "respuesta", "message", "mensaje"];
      for (const campo of campos) {
        if (typeof objeto[campo] === "string" && objeto[campo].trim() !== "") {
          return objeto[campo];
        }
      }
      return "Make respondió, pero sin el campo response";
    }

    // Fallback por expresión regular si JSON.parse falló por saltos de línea sin escapar
    const extraidoRegex = extraerPorRegex(limpio);
    if (extraidoRegex !== null) {
      return extraidoRegex;
    }
  }

  // Si no es un objeto válido (es texto plano, número, array, etc.), devolver tal cual
  return limpio;
}

// Intenta parsear JSON y reintenta escapando saltos de línea dentro de valores string
function intentarParsearJson(textoJson) {
  try {
    return JSON.parse(textoJson);
  } catch (e) {
    try {
      const escapado = textoJson.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
        return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
      });
      return JSON.parse(escapado);
    } catch (e2) {
      return null;
    }
  }
}

// Extrae manualmente el valor de response, respuesta, message o mensaje si el JSON está roto
function extraerPorRegex(texto) {
  const campos = ["response", "respuesta", "message", "mensaje"];
  for (const campo of campos) {
    const regex = new RegExp(`"${campo}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\vert{}\\})`); const match = texto.match(regex); if (match && match[1].trim() !== "") { return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'); } } return null; }  // Función auxiliar para agregar burbujas al DOM en la ZONA CHAT (usando textContent) function appendMessage(sender, text, isError = false) { const messageArticle = document.createElement("article"); messageArticle.classList.add("message", `${sender}-message`);
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

  const dotsContainer = document.createElement("div");
  dotsContainer.classList.add("loading-dots");

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("div");
    dot.classList.add("dot");
    dotsContainer.appendChild(dot);
  }

  bubbleDiv.appendChild(dotsContainer);
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
