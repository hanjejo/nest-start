---
name: graphify
description: Query and maintain this repository's Graphify knowledge graph.
disable-model-invocation: true
---

# Graphify

Use the locally installed Graphify CLI for repository architecture questions.

Ensure the CLI is available:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

If `graphify-out/graph.json` does not exist, build it:

```bash
graphify extract . --code-only
```

Use the command that matches the request:

```bash
graphify query "<question>"
graphify path "<symbol or file A>" "<symbol or file B>"
graphify explain "<concept>"
graphify affected "<symbol or file>"
graphify god-nodes
```

After source changes, refresh the graph:

```bash
graphify update .
```
