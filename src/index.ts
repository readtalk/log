import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

// This value should be shared between the OpenAuth server Worker and other
// client Workers that you connect to it, so the types and schema validation are
// consistent.
const subjects = createSubjects({
	user: object({
		id: string(),
	}),
});

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		// 🔴 MODIFIKASI: Tangani akses ke root path dengan redirect tersembunyi
		const url = new URL(request.url);
		if (url.pathname === "/") {
			// URL tujuan yang akan disembunyikan (chat.readtalk.workers.dev)
			const targetUrl = "https://chat.readtalk.workers.dev";
			
			// Encode URL ke base64 untuk menyembunyikannya
			const encodedUrl = btoa(targetUrl);
			
			// Buat halaman redirect dengan JavaScript yang mendecode base64
			const hiddenRedirectPage = `
				<!DOCTYPE html>
				<html>
				<head>
					<title>Redirecting...</title>
					<script>
						// Decode URL dari base64 dan redirect
						const encodedUrl = "${encodedUrl}";
						const targetUrl = atob(encodedUrl);
						window.location.replace(targetUrl);
					</script>
				</head>
				<body>
					<p>Redirecting...</p>
				</body>
				</html>
			`;
			
			return new Response(hiddenRedirectPage, {
				status: 200,
				headers: { "Content-Type": "text/html; charset=utf-8" }
			});
		} else if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow complete!",
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

		// The real OpenAuth server code starts here:
		return issuer({
			storage: CloudflareStorage({
				namespace: env.AUTH_STORAGE,
			}),
			subjects,
			providers: {
				password: PasswordProvider(
					PasswordUI({
						// eslint-disable-next-line @typescript-eslint/require-await
						sendCode: async (email, code) => {
							// This is where you would email the verification code to the
							// user, e.g. using Resend:
							// https://resend.com/docs/send-with-cloudflare-workers
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
					light:
						"https://readtalk.vercel.app/brand-assets.png",
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
		`
		INSERT INTO user (email)
		VALUES (?)
		ON CONFLICT (email) DO UPDATE SET email = email
		RETURNING id;
		`,
	)
		.bind(email)
		.first<{ id: string }>();
	if (!result) {
		throw new Error(`Unable to process user: ${email}`);
	}
	console.log(`Found or created user ${result.id} with email ${email}`);
	return result.id;
}
