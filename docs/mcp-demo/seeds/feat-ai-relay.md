# Feature Demo: MCP + AI Relay Bridge

> Seed for the feat-ai-relay demo recording.
> Shows MCP tool list, bookmarklet injection, AI tool calls via relay.
>
> Spec: `e2e/demo-feat-ai-relay.spec.ts`
> Note: This demo uses stage mode (openStage) — tool calls execute on the app iframe.

---

**Assistant:** Loading the reasoning demo ontology on the app side.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Ontosphere loaded — ready for AI relay connection
slug: app-loaded
```
