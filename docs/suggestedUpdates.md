Documents like @projectRequirements.md should not be edited by AI, and so if you think anything should be changed add it here

---

## Suggested additions for `projectRequirements.md` / folio (manual merge)

- **Authentication**: No traditional passwords. Sign-in with **email + 6-digit one-time code** plus **Google OAuth**.
- **AI scope**: AI may **create, move, reschedule, and delete** both **tasks** and **activities**. Direct user calendar edits are limited to **complete**, **delete**, **reschedule overdue**, and **modal detail/edit** as a complement to AI.
- **Activities**: Each activity has **`movable`**; **default is not movable** unless the user explicitly allows it (or states it in natural language for the AI to record).
- **Defaults**: Timezone **Australia/Sydney**; default visible **working hours 06:00–22:00**.
- **Hybrid model**: Combine **todo** (duration in minutes, e.g. 15) with **calendar** placement; week view is time-based within working hours.
- **Split sessions**: A single logical scheduled item may occupy **multiple non-contiguous time segments** without being stored or shown as duplicate separate items/cards.
- **Recurrence**: Support **complex recurrence** including **exceptions** (e.g. skip specific weeks or dates).
- **Teacher / submission**: Primary review path is **hosted app on Vercel**; local run may require **MongoDB** and **env placeholders**—**do not commit API keys**; README lists required env vars only.
- **Assessment doc vs stack**: Official notification references **Python** / `requirements.txt`; actual implementation uses **Next.js + TypeScript + MongoDB** as approved in your project requirements—folio should state that clearly for markers.