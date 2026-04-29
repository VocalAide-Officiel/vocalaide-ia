/**
 * LLM Chat App Frontend - VocalAide IA
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing"); // Correspond à l'ID dans le nouveau HTML

// Chat state
let chatHistory = []; 
let isProcessing = false;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();

	// Don't send empty messages
	if (message === "" || isProcessing) return;

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message to chat UI
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	if(typingIndicator) typingIndicator.style.display = "block";

	// Add message to history
	chatHistory.push({ role: "user", content: message });

	try {
		// Create new assistant response element
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";
		assistantMessageEl.innerHTML = "<p></p>";
		chatMessages.appendChild(assistantMessageEl);
		const assistantTextEl = assistantMessageEl.querySelector("p");

		// Scroll to bottom
		chatMessages.scrollTop = chatMessages.scrollHeight;

		// On envoie le 'tone' défini dans le HTML
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
				tone: window.currentTone || 'empathique' 
			}),
		});

		if (!response.ok) throw new Error("Erreur réseau");
		if (!response.body) throw new Error("Pas de corps de réponse");

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";
		
		const flushAssistantText = () => {
			assistantTextEl.textContent = responseText;
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

		let sawDone = false;
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				const parsed = consumeSseEvents(buffer + "\n\n");
				for (const data of parsed.events) {
					if (data === "[DONE]") break;
					try {
						const jsonData = JSON.parse(data);
						let content = jsonData.response || jsonData.choices?.[0]?.delta?.content || "";
						if (content) {
							responseText += content;
							flushAssistantText();
						}
					} catch (e) {}
				}
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;
			for (const data of parsed.events) {
				if (data === "[DONE]") {
					sawDone = true;
					break;
				}
				try {
					const jsonData = JSON.parse(data);
					let content = jsonData.response || jsonData.choices?.[0]?.delta?.content || "";
					if (content) {
						responseText += content;
						flushAssistantText();
					}
				} catch (e) {}
			}
			if (sawDone) break;
		}

		// AJOUT IMPORTANT : Fin de réponse
		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
            
            // Si l'utilisateur a cliqué sur "Rapport PDF", on lance la génération
            if (window.isGeneratingPdf) {
                setTimeout(() => {
                    window.triggerPdfDownload(responseText);
                }, 500); // Petit délai pour laisser l'UI respirer
            }
		}
	} catch (error) {
		console.error("Error:", error);
		addMessageToChat("assistant", "Désolé, une erreur technique est survenue.");
	} finally {
		if(typingIndicator) typingIndicator.style.display = "none";
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

/**
 * Helper function to add message to chat UI
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;
	messageEl.innerHTML = `<p></p>`;
    messageEl.querySelector("p").textContent = content;
	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;
	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines = [];
		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}
		if (dataLines.length === 0) continue;
		events.push(dataLines.join("\n"));
	}
	return { events, buffer: normalized };
}
