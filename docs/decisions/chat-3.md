---
id: chat-3
title: "A private demonstration store first: eternal-circle"
round: "chat"
date: "2026-10-09"
status: accepted
decided_by: owner
sources:
  chat: ["2026-10-09T23:14:41Z", "2026-10-09T23:31:55Z"]
  session: ["2026-10-09T23:15:01Z"]
  prs: [60]
  commits: ["5b0819b", "1cc6071"]
---

## Question

The implementation needs a store of real tickets to demonstrate vmd, and later GitHub as a backend. Where?

## Options

- **(a) A private tickets repository under `nosferatech` first**, then a separate public `vollmond-practice` repository once it
  matures, for demonstration and testing of GitHub as a backend. Chosen, as the session recommended.
- **(b) Start with the public `vollmond-practice`.** The owner offered it if it made things easier.

## Decision

(a). The private repository `nosferatech/eternal-circle`, which the owner created, is the ticket store, first needed in I2.7
(configuration and schemas) and then I3.7 (the importer of vampiredb's tickets). A public `vollmond-practice` follows once the
private store has matured.

## Why

The session's reason: vampiredb's tickets are private content, so they can only live in a private repository, and a public
repository would need made-up data, which exercises little.

## Owner's note

> for demonstration, we can create a private repo for tickets under nosferatech/ . And iterate on that. Once the repo matures, we
> can create a separate public vollmond-practice repo where that can be used for demo and testing purposes of the github as
> backend for vollmond.
> Alternatively, if it would make it easier, we can start with vollmond-practice .

> and created a private repo for testing tickets using vollmond in [eternal-circle]

## Applied in

The implementation plan: `5b0819b` recorded both repositories, and `1cc6071` named `nosferatech/eternal-circle` as the ticket store
(§1.4). #60 pointed the plan at eternal-circle once the tickets had moved there with project-prefixed ids. K3 later made
eternal-circle a vmd store with its own configuration.
