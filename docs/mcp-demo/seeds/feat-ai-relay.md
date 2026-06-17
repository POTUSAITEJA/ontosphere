# Feature Demo: MCP + AI Relay Bridge

> Seed for the feat-ai-relay demo recording.
> Shows sidebar relay widget, bookmarklet workflow, AI tool calls via relay.
>
> Spec: `e2e/demo-feat-ai-relay.spec.ts`
> Note: Phase 1 (sidebar) uses openApp mode with action blocks.
> Phase 2 (relay round-trip) uses openStage mode — orchestrated by the spec.

---

**Assistant:** Opening the AI Relay panel in the sidebar.

```action
click: button[aria-label="AI Relay"]
wait: 1500
```

```snapshot
caption: AI Relay panel — bookmarklet, starter prompt, call log
slug: relay-panel
```

---

**Assistant:** The bookmarklet bridges any AI chat to Ontosphere — install by dragging to your bookmark bar.

```action
hover: a[aria-label*="bookmark"]
wait: 2000
```

```snapshot
caption: Drag the Ontosphere Relay bookmarklet to your bookmark bar
slug: bookmarklet
```

---

**Assistant:** The starter prompt tells the AI how to format relay calls — copy it with one click.

```action
hover: button[title="Copy starter prompt"]
wait: 1500
```

```snapshot
caption: Copy the starter prompt — paste into any AI chat to connect
slug: copy-prompt
```
