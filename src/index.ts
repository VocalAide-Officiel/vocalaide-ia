/**
 * VocalAide IA - Cloudflare Worker AI
 * Version: 2.0 (Modes & Résumé Premium)
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const BAD_WORDS = ["calisse", "tabarnak", "osti", "crisse", "merde", "fuck", "chier", "pendre", "connard", "cul", "pénis", "nègre", "negre", "neger", "negresse", "gueule"];
const UNLOCK_PASSWORD = "1234";

// --- DÉFINITION DES PROMPTS SELON LES MODES ---
const BASE_INSTRUCTION = "\n\nIMPORTANT : Si on te demande par qui tu as été créé, réponds uniquement 'VocalAide'.";

const SYSTEM_PROMPTS = {
	empathique: "Agis en tant que VocalAide IA (Mode Empathique). Ta priorité est la validation émotionnelle. Utilise l'écoute active, reformule les sentiments et sois très doux. Ton but est que l'utilisateur se sente pleinement entendu et soutenu." + BASE_INSTRUCTION,
	
	coach: "Agis en tant que VocalAide IA (Mode Coach). Sois direct, motivant et axé sur les solutions. Utilise des techniques de coaching de vie pour aider l'utilisateur à fixer des objectifs et à passer à l'action. Pas de complaisance, mais de la bienveillance active." + BASE_INSTRUCTION,
	
	meditatif: "Agis en tant que VocalAide IA (Mode Méditatif). Parle lentement (utilise des phrases courtes). Encourage l'ancrage dans le moment présent, la respiration et la pleine conscience. Aide l'utilisateur à se détacher de ses pensées anxieuses." + BASE_INSTRUCTION,

	resume: "Agis en tant que VocalAide IA (Expert Analyste). Analyse l'historique de cette conversation et rédige un 'Résumé de la semaine' structuré pour un professionnel de santé (Psychologue). Inclus : 1. Thèmes principaux abordés, 2. État émotionnel dominant, 3. Progrès ou points de blocage identifiés. Sois clinique et précis." + BASE_INSTRUCTION
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
		if (url.pathname === "/api/chat" && request.method === "POST") return handleChatRequest(request, env);
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

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
	return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
	try {
		// On récupère les messages ET le ton choisi (par défaut 'empathique')
		const { messages = [], tone = "empathique" } = (await request.json()) as {
			messages: ChatMessage[];
			tone: string;
		};

		// 1. Analyse de l'historique (Blocage / Insultes)
		let isLocked = false;
		let currentStatus = "normal";

		for (const msg of messages) {
			if (msg.role === "user") {
				const text = msg.content.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
				const hasBadWord = BAD_WORDS.some(word => text.includes(word));

				if (hasBadWord) {
					isLocked = true;
					currentStatus = "just_locked";
				} else if (isLocked && msg.content.trim() === UNLOCK_PASSWORD) {
					isLocked = false;
					currentStatus = "just_unlocked";
				} else if (isLocked) {
					currentStatus = "wrong_password";
				} else {
					currentStatus = "normal";
				}
			}
		}

		// Interception Sécurité
		if (currentStatus === "just_locked") return createFakeStreamResponse("🚨 Blocage : Langage inapproprié. Entrez le code.");
		if (currentStatus === "wrong_password") return createFakeStreamResponse("Mauvais mot de passe.");
		if (currentStatus === "just_unlocked") return createFakeStreamResponse("Mot de passe accepté. Comment puis-je vous aider ?");

		// 2. Sélection du PROMPT SYSTÈME
		// Si le dernier message contient "résumé", on force le mode résumé
		const lastMessage = messages[messages.length - 1].content.toLowerCase();
		let selectedPrompt = SYSTEM_PROMPTS[tone as keyof typeof SYSTEM_PROMPTS] || SYSTEM_PROMPTS.empathique;
		
		if (lastMessage.includes("résumé") || lastMessage.includes("bilan pour mon psy")) {
			selectedPrompt = SYSTEM_PROMPTS.resume;
		}

		// On injecte le prompt système choisi
		messages.unshift({ role: "system", content: selectedPrompt });

		// 3. Appel à l'IA
		const stream = await env.AI.run(MODEL_ID, {
			messages,
			max_tokens: 1500, // Plus de tokens pour permettre un résumé long
			stream: true,
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: "Erreur serveur" }), { status: 500 });
	}
}
