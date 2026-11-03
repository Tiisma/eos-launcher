// Local tooling for the Sombreterre pack (src/domain/sombreterre/pack.ts).
//
//   node scripts/sombreterre/pack.mjs serve [folder] [port]   Serves the folder on http://127.0.0.1:<port>/
//   node scripts/sombreterre/pack.mjs hash <archive.zip>      Prints the manifest entry fields for a private Mod
//
// Loopback only, read only, flat folder only: this is for local testing, not for hosting the pack.
import { createHash } from "node:crypto"
import { createReadStream, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { basename, join, resolve } from "node:path"

const [command, ...args] = process.argv.slice(2)

if (command === "hash") {
  const file = args[0]
  if (!file) throw new Error("Usage: pack.mjs hash <archive.zip>")
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex")
  console.log(JSON.stringify({ source: "private", modid: "<modid>", version: "<version>", file: basename(file), sha256 }, null, 2))
} else if (command === "serve") {
  const root = resolve(args[0] ?? "pack")
  const port = Number(args[1] ?? 8787)
  const types = { ".json": "application/json; charset=utf-8", ".zip": "application/zip" }

  createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(1))
    // One plain file name, nothing that can climb out of the folder.
    if (request.method !== "GET" || !/^[^\\/]+\.(json|zip)$/i.test(name) || name.startsWith(".")) {
      response.writeHead(404).end()
      return
    }
    const path = join(root, name)
    let size
    try {
      const stats = statSync(path)
      if (!stats.isFile()) throw new Error("not a file")
      size = stats.size
    } catch {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "Content-Type": types[name.slice(name.lastIndexOf(".")).toLowerCase()], "Content-Length": size, "Cache-Control": "no-store" })
    createReadStream(path).pipe(response)
    console.log(`${request.method} /${name}`)
  }).listen(port, "127.0.0.1", () => console.log(`Serving ${root} on http://127.0.0.1:${port}/`))
} else {
  console.log("Usage: pack.mjs serve [folder] [port] | pack.mjs hash <archive.zip>")
  process.exitCode = 1
}
