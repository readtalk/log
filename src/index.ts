import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";
import { nanoid } from 'nanoid';

const subjects = createSubjects({
	user: object({
		id: string(),
	}),
});

// ====== 1. HELPER: Cek & Dapatkan Data Profil ======
async function getUserProfile(env: Env, email: string): Promise<{ id: string; username: string | null; full_name: string | null }> {
	const user = await env.AUTH_DB.prepare(
		`SELECT id, username, full_name FROM user WHERE email = ?`
	).bind(email).first<{ id: string; username: string | null; full_name: string | null }>();
	if (!user) {
		throw new Error(`User not found for email: ${email}`);
	}
	return user;
}

// ====== 2. HELPER: Buat Token Sederhana untuk chat.readtalk ======
function createUserToken(payload: { email: string; userId: string; username: string }): string {
	// Token sederhana: JSON -> Base64 (UNTUK CONTOH. Produksi butuh signing/encryption)
	const jsonStr = JSON.stringify(payload);
	return btoa(unescape(encodeURIComponent(jsonStr))); // btoa untuk base64 encode
}

// ====== 3. HELPER: Manage State untuk Halaman Profil ======
async function createProfileState(env: Env, email: string): Promise<string> {
	const stateToken = nanoid(32);
	await env.AUTH_STORAGE.put(
		`profile_state:${stateToken}`,
		JSON.stringify({ email }),
		{ expirationTtl: 600 }
	);
	return stateToken;
}
async function getProfileState(env: Env, stateToken: string): Promise<{ email: string } | null> {
	const data = await env.AUTH_STORAGE.get(`profile_state:${stateToken}`, { type: "json" });
	return data as { email: string } | null;
}

// ====== 4. ENDPOINT: HALAMAN LENGKAPI PROFIL ======
async function handleCompleteProfile(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const stateToken = url.searchParams.get("state");

	// --- POST: Submit Form ---
	if (request.method === "POST") {
		if (!stateToken) return new Response("Invalid session", { status: 400 });
		const stateData = await getProfileState(env, stateToken);
		if (!stateData) return new Response("Session expired", { status: 400 });

		const { email } = stateData;
		try {
			const formData = await request.formData();
			const username = formData.get("username")?.toString().trim() || "";
			const fullName = formData.get("fullName")?.toString().trim() || "";

			if (!username) return new Response("Username required", { status: 400 });

			// Update database
			await env.AUTH_DB.prepare(
				`UPDATE user SET username = ?, full_name = ? WHERE email = ?`
			).bind(username, fullName || null, email).run();

			// Hapus state
			await env.AUTH_STORAGE.delete(`profile_state:${stateToken}`);

			// Dapatkan data user terbaru untuk buat token
			const user = await getUserProfile(env, email);
			// Buat token dan redirect KE CHAT.READTALK
			const userToken = createUserToken({
				email: email,
				userId: user.id,
				username: username
			});
			const chatRedirectUrl = `https://chat.readtalk.workers.dev?token=${encodeURIComponent(userToken)}`;
			return Response.redirect(chatRedirectUrl, 302);

		} catch (error) {
			console.error("Error saving profile:", error);
			return new Response("Internal error", { status: 500 });
		}
	}

	// --- GET: Tampilkan Form ---
	if (!stateToken) return Response.redirect("/", 302);
	const stateData = await getProfileState(env, stateToken);
	if (!stateData) return new Response("Session expired", { status: 400 });

	const { email } = stateData;
	const html = `
<!DOCTYPE html><html><head>
<title>Lengkapi Profil - READTalk</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;max-width:400px;margin:40px auto;padding:20px;}
h2{color:#ff0000;}label{display:block;margin-top:1rem;}input{width:100%;padding:8px;margin-top:4px;box-sizing:border-box;}
button{background:#ff0000;color:white;border:none;padding:12px;margin-top:1.5rem;width:100%;cursor:pointer;}
.info{background:#f0f0f0;padding:10px;border-radius:4px;margin-bottom:1rem;}</style>
</head><body>
	<h2>🎯 Lengkapi Profil</h2>
	<div class="info">Email: <strong>${email}</strong></div>
	<form method="POST">
		<label for="username">Username (wajib)</label>
		<input type="text" id="username" name="username" required placeholder="johndoe_">
		<label for="fullName">Nama Lengkap (opsional)</label>
		<input type="text" id="fullName" name="fullName" placeholder="John Doe">
		<button type="submit">✅ Selesai & Masuk ke Chat</button>
	</form>
</body></html>
	`;
	return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

// ====== 5. FUNGSI UTAMA dengan Modifikasi Alur ======
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Tangani endpoint profil
		if (url.pathname === "/complete-profile") {
			return handleCompleteProfile(request, env);
		}

		// Demo routing (tetap sama)
		if (url.pathname === "/") {
			url.searchParams.set("redirect_uri", url.origin + "/callback");
			url.searchParams.set("client_id", "your-client-id");
			url.searchParams.set("response_type", "code");
			url.pathname = "/authorize";
			return Response.redirect(url.toString());
		} else if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow complete!",
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

		// Konfigurasi OpenAuth.js
		return issuer({
			storage: CloudflareStorage({ namespace: env.AUTH_STORAGE }),
			subjects,
			providers: {
				password: PasswordProvider(
					PasswordUI({
						sendCode: async (email, code) => {
							console.log(`[DEBUG] Code ${code} to ${email}`);
						},
						copy: { input_code: "Kode (lihat log)" },
					}),
				),
			},
			theme: {
				title: "READTalk Authentication",
				primary: "#ff0000",
				favicon: "https://readtalk.vercel.app/favicon.ico",
				logo: {
					dark: "https://readtalk.vercel.app/brand-assets.png",
					light: "https://readtalk.vercel.app/brand-assets.png",
				},
			},
			// ====== MODIFIKASI CALLBACK 'success' ======
			success: async (ctx, value) => {
				const userId = await getOrCreateUser(env, value.email);
				// Cek profil user
				const userProfile = await getUserProfile(env, value.email);

				if (!userProfile.username) {
					// PROFIL BELUM LENGKAP: Arahkan ke form
					const stateToken = await createProfileState(env, value.email);
					const profileUrl = new URL("/complete-profile", request.url);
					profileUrl.searchParams.set("state", stateToken);
					return Response.redirect(profileUrl.toString(), 302);
				} else {
					// PROFIL SUDAH LENGKAP: Buat token & redirect langsung ke chat.readtalk
					const userToken = createUserToken({
						email: value.email,
						userId: userProfile.id,
						username: userProfile.username
					});
					const chatRedirectUrl = `https://chat.readtalk.workers.dev?token=${encodeURIComponent(userToken)}`;
					return Response.redirect(chatRedirectUrl, 302);
				}
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

// ====== 6. FUNGSI getOrCreateUser (Tetap) ======
async function getOrCreateUser(env: Env, email: string): Promise<string> {
	const result = await env.AUTH_DB.prepare(
		`INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id;`
	).bind(email).first<{ id: string }>();
	if (!result) throw new Error(`Unable to process user: ${email}`);
	return result.id;
}
