# TheAmazingDigitalService

## Folio video assistant

A responsive TypeScript/React workspace with a vertical video, text composer, and three selectable assistants. Includes portrait playback, pause, captions, browser speech, expanded video, a transcript, and accessible keyboard navigation.

### Run locally

```sh
npm install
npm run dev
```

The app uses Vinext with React 19. `npm run build` builds the production Worker and client assets. `npx tsc --noEmit` checks TypeScript.

### Demo behavior

This is a frontend prototype. Messages receive guided sample replies; portrait videos are prerecorded stock clips and are not lip-synced. Audio uses the browser’s SpeechSynthesis API when enabled. Conversations live in memory and clear on refresh. No messages are sent to an AI service.

To enable live responses, replace `demoReply` and the delayed response in `app/page.tsx` with a server-side AI integration and a licensed avatar video/streaming provider. Keep provider credentials on the server and supply the returned stream or video URL to the player.

Assistant selection is also exposed through the optional `select_assistant` WebMCP tool in supported browsers.

### Media

Sample portraits and clips are from Pexels. Provenance and source URLs are in `public/assistants/sources.json`. The fictional assistant identities do not imply endorsement by the people depicted.
