// Referencias a los elementos del DOM respetando las zonas indicadas
const zonaChat = document.getElementById("zona-chat");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

// Variables de estado
let isWaiting = false;
const TIMEOUT_MS = 10000; // Tiempo límite de 10 segundos
const COOLDOWN_MS = 2000; // Tiempo de espera entre envíos (2 segundos)

// Event Listener para el formulario de envío
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = userInput.value.trim();

  if (!message || isWaiting) return;

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

// Función para enviar la consulta al Webhook con protección y manejo asíncrono
async function sendMessageToAgent(promptText) {
  setLoadingState(true);

  // Crear indicador visual de "pensando"
  const loadingElement = appendLoadingIndicator();

  // Control de aborto por tiempo de espera excedido
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error en el servidor: ${response.status}`);
    }

    const data = await response.json();
    
    // Eliminar indicador de carga
    loadingElement.remove();

    // Mostrar respuesta obtenida
    const reply = data.reply || data.respuesta || "No se pudo obtener el resultado del partido.";
    appendMessage("agent", reply);

  } catch (error) {
    clearTimeout(timeoutId);
    loadingElement.remove();

    let errorMessage = "Ocurrió un error al consultar el resultado. Intentalo de nuevo.";
    if (error.name === "AbortError") {
      errorMessage = "La consulta tardó demasiado tiempo. Por favor reintentá.";
    }

    appendMessage("agent", errorMessage, true);
  } finally {
    // Aplicar temporizador de enfriamiento entre envíos
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

// Función auxiliar para mostrar los puntos de carga
function appendLoadingIndicator() {
  const loadingArticle = document.createElement("article");
  loadingArticle.classList.add("message", "agent-message");

  loadingArticle.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="bubble">
      <div class="loading-dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  `;

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
