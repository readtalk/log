import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
	user: object({
		id: string(),
	}),
});

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		
		// **PERUBAHAN SATU-SATUNYA (sesuai permintaan):**
		// Ganti alur demo OAuth dengan redirect ke chat.readtalk (URL dalam base64)
		if (url.pathname === "/") {
			const b = 'aHR0cHM6Ly9jaGF0LnJlYWR0YWxrLndvcmtlcnMuZGV2'; // https://chat.readtalk.workers.dev
			const targetUrl = atob(b);
			return Response.redirect(targetUrl, 302);
		}
		// **AKHIR DARI MODIFIKASI**
		
		else if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow complete!",
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

		// The real OpenAuth server code starts here (TIDAK DIUBAH):
		return issuer({
			storage: CloudflareStorage({
				namespace: env.AUTH_STORAGE,
			}),
			subjects,
			providers: {
				password: PasswordProvider(
					PasswordUI({
						sendCode: async (email, code) => {
							console.log(`Sending code ${code} to ${email}`);
						},
						copy: {
							input_code: "Code (check Worker logs)",
						},
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
			success: async (ctx, value) => {
				return ctx.subject("user", {
					id: await getOrCreateUser(env, value.email),
				});
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

async function getOrCreateUser(env: Env, email: string): Promise<string> {
	const result = await env.AUTH_DB.prepare(
		`INSERT INTO user (email) VALUES (?) ON CONFLICT (email) DO UPDATE SET email = email RETURNING id;`
	).bind(email).first<{ id: string }>();
	if (!result) throw new Error(`Unable to process user: ${email}`);
	console.log(`Found or created user ${result.id} with email ${email}`);
	return result.id;
}
