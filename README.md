# ChatGPT Context Bridge

ChatGPT Context Bridge is a Chrome extension that helps you turn your recent browsing activity into a prompt you can copy or send to ChatGPT.

It captures local session context such as visited pages, selected text, and optional form input snippets, then formats that context into a single report for review and export.

## Install

- Chrome Web Store: [ChatGPT Context Bridge](https://chromewebstore.google.com/detail/chatgpt-context-bridge/fbfnfmclceoljolianhgdjdnligcabik)

For local development, load this repository as an unpacked extension:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this repository folder

## Features

- Copy the current session context to the clipboard
- Send the composed context directly to ChatGPT
- Capture selected text snippets from visited pages
- Optionally capture non-password form input text
- Group recent browsing history by day
- Export history as CSV
- Apply role-prefixed prompts such as `Data Analyst` or `Recommendation Coach`

## Usage

1. Browse normally
2. Open the extension popup
3. Choose `Copy Context` or `Send to ChatGPT`
4. Use `Options` to adjust capture settings and domain filters
5. Use `History` to review, export, or clear recent captured history

## Development

This project does not require a build step. The extension is made up of plain HTML, CSS, and JavaScript files:

- [manifest.json](manifest.json)
- [background.js](background.js)
- [content.js](content.js)
- [inject_chatgpt.js](inject_chatgpt.js)
- [popup.html](popup.html)
- [options.html](options.html)
- [history.html](history.html)

After making changes, reload the unpacked extension from `chrome://extensions`.

## Privacy

- Data is stored locally in the browser
- The extension does not send data to a custom backend
- Data is only shared with ChatGPT when you explicitly copy or send it

If form input capture is enabled, sensitive text may be recorded unless you disable that setting or block the relevant domains.

## License

MIT. See [LICENSE](LICENSE).
