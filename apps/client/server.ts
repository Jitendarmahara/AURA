Bun.serve({
  port: 3000,
  fetch() {
    return new Response(Bun.file(new URL("./index.html", import.meta.url)));
  },
});

console.log("client on http://localhost:3000");
