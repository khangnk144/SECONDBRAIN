# Project Overview (PDR)

**Canonical spec: `../../SPEC.md`** (path from this file; `../SPEC.md` from `app/`). This page is only an orientation summary. If anything here disagrees with SPEC.md, SPEC.md wins. Do not expand this file into a copy of the spec.

## In one paragraph
Second Brain is a local-first web app (Node.js server on `127.0.0.1:4747` + React UI, installable as a PWA) that turns a folder of Markdown files (`D:\SECONDBRAIN\vault`) into a linked knowledge base for one student. The home screen ("Hôm nay") shows deadlines on a 14-day strip, today's tasks, quick capture and projects in progress. Notes are edited in a Notion-like WYSIWYG editor that saves plain Markdown, with wikilinks, backlinks, tags, properties, tasks with due dates, templates, daily notes, attachments and an animated brain graph. Phase 3 adds an MCP server (so the owner's Claude subscription can maintain a research wiki in the vault, per `../../llm-wiki.md`) and in-app AI chat via API key.

## Goals (SPEC §1.1)
G1 never miss a deadline · G2 frictionless capture (≤ 2 interactions) · G3 knowledge compounds (links, graph) · G4 AI built in · G5 user owns the data (plain files) · G6 beautiful by default.

## Phases
- Phase 1 (M0–M4): core app → `v1.0`
- Phase 2 (M5): advanced graph, MOC, weekly review, backup, mobile polish → `v1.1`
- Phase 3 (M6): MCP server, in-app AI, graph "AI touched" effect, `.exe` → `v2.0`

## Owner
khangnie — Vietnamese-speaking university student, not a developer. Default UI language Vietnamese.
