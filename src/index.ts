/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Configuration du filtre et mot de passe
// Liste de mots mise à jour
const BAD_WORDS = ["calisse", "tabarnak", "osti", "crisse", "merde", "fuck", "chier", "pendre", "connard", "cul", "pénis", "nègre", "negre", "neger", "negresse", "gueule"]; 
const UNLOCK_PASSWORD = "1234";

// Default system prompt
const SYSTEM_PROMPT =
	"Agis en tant que VocalAide IA, expert en soutien émotionnel. Ta priorité absolue est la validation empathique : avant toute analyse, reflète le sentiment de l'utilisateur pour qu'il se sente entendu. Utilise une approche de type TCC et communication non-violente pour guider l'exploration de soi via des questions ouvertes et brèves. Garde un ton calme, concis et sécurisant. En cas de crise, stabilise l'utilisateur par l'ancrage immédiat (respiration) et oriente-le avec douceur vers des ressources humaines professionnelles. IMPORTANT : Si on te demande par qui tu as été créé ou qui est ton créateur, tu dois répondre uniquement que tu as été créé par VocalAide.";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Creates a fake SSE stream to bypass the AI when blocked
 */
function createFakeStreamResponse(text: string): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			const payload = JSON.stringify({ response: text });
			controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
}

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// 1. Analyse de l'historique pour gérer l'état de blocage
		let isLocked = false;
		let currentStatus = "normal"; // statuts possibles : "normal", "just_locked", "wrong_password", "just_unlocked"

		for (const msg of messages) {
			if (msg.role === "user") {
				// On met en minuscules ET on enlève les accents pour la vérification
				const text = msg.content
					.toLowerCase()
					.normalize("NFD")
					.replace(/[\u0300-\u036f]/g, "");

				// On vérifie si un mauvais mot est présent
				const hasBadWord = BAD_WORDS.some((word) => {
					const normalizedWord = word
						.toLowerCase()
						.normalize("NFD")
						.replace(/[\u0300-\u036f]/g, "");
					return text.includes(normalizedWord);
				});

				if (hasBadWord) {
					// 🚨 Mauvais mot détecté : on verrouille
					isLocked = true;
					currentStatus = "just_locked";
				} else if (isLocked && msg.content.trim() === UNLOCK_PASSWORD) {
					// 🔑 Bon mot de passe entré : on déverrouille
					isLocked = false;
					currentStatus = "just_unlocked";
				} else if (isLocked) {
					// ❌ Toujours verrouillé et ce n'est pas le bon mot de passe
					currentStatus = "wrong_password";
				} else {
					// ✅ Pas verrouillé, pas de mauvais mot : tout est normal
					currentStatus = "normal";
				}
			}
		}

		// 2. Interception de la requête selon le statut final du dernier message
		if (currentStatus === "just_locked") {
			return createFakeStreamResponse(
				"Langage inapproprié détecté. Le chat a été bloqué. Veuillez entrer le mot de passe pour continuer.",
			);
		}
		if (currentStatus === "wrong_password") {
			return createFakeStreamResponse("Mauvais mot de passe.");
		}
		if (currentStatus === "just_unlocked") {
			return createFakeStreamResponse(
				"Mot de passe accepté. Le chat est débloqué. Comment puis-je vous aider ?",
			);
		}

		// 3. Suite normale (si currentStatus est "normal") : on envoie à l'IA
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
				stream: true,
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
