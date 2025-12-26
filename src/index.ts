import { OpenAuthJs } from "@open-auth/js";
import { OpenAuthJsConfig } from "@open-auth/js/src/config";
import { User, CreateUser } from "./types";

// --- TAMBAHAN BARU: Import dan definisi untuk Durable Object ---
import { DurableObject } from "cloudflare:workers";

// 1. Definisikan class Durable Object LogRoom
export class LogRoom extends DurableObject {
	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
	}

	async sayHello() {
		return "Hello from LogRoom Durable Object!";
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		if (url.pathname === "/hello") {
			const greeting = await this.sayHello();
			return new Response(greeting);
		}
		return new Response("Not found", { status: 404 });
	}
}

// 2. Update interface Env untuk menambahkan binding LOG_ROOM_DO
export interface Env {
	AUTH_STORAGE: KVNamespace;
	AUTH_DB: D1Database;
	// --- TAMBAHAN BARU: Binding Durable Object ---
	LOG_ROOM_DO: DurableObjectNamespace<LogRoom>;
}

// --- KODE YANG SUDAH ADA (TIDAK DIUBAH) ---
const config: OpenAuthJsConfig = {
	// ... (kode config yang sudah ada tetap sama)
	client: {
		// ... (kode client config yang sudah ada)
	},
	storage: {
		async getUser(email: string) {
			// ... (kode getUser yang sudah ada)
		},
		async createUser(user: CreateUser) {
			// ... (kode createUser yang sudah ada)
		},
		async updateUser(email: string, user: Partial<User>) {
			// ... (kode updateUser yang sudah ada)
		},
	},
};

const openAuth = new OpenAuthJs(config);

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// --- TAMBAHAN BARU: Handler untuk testing Durable Object ---
		if (url.pathname === "/test-do") {
			// Dapatkan ID berdasarkan nama/identifier yang unik
			const id = env.LOG_ROOM_DO.idFromName("test-room");
			
			// Dapatkan stub ke instance Durable Object
			const stub = env.LOG_ROOM_DO.get(id);
			
			// Panggil method melalui fetch
			const doRequest = new Request(`${url.origin}/hello`, {
				method: "GET",
			});
			return stub.fetch(doRequest);
		}
		
		// --- KODE YANG SUDAH ADA (TIDAK DIUBAH) ---
		// Handler untuk path /password/*
		if (url.pathname.startsWith("/password/")) {
			return openAuth.handle(request, {
				storage: env.AUTH_STORAGE,
				db: env.AUTH_DB,
			});
		}
		
		// Handler default
		return new Response("Hello from log worker!", {
			headers: { "content-type": "text/plain" },
		});
	},
};

// --- TAMBAHAN BARU: Export class LogRoom untuk binding ---
export { LogRoom };
