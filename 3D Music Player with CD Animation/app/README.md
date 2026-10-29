# MUN15H — the music player

A React + TypeScript + Vite front end over a Tauri shell: a 3D CD-deck
player for the music on this machine, plus an online side that is the
Dannify extension running from the `dannify/` folder beside the player.

```bash
npm run dev        # the interface, against a running Tauri shell
npm run tauri dev  # the real thing
npm run build      # type-check + production build
npm run dannify:update -- --from <path>   # update the extension (see below)
```

Where the answers live:

| Doc | What is in it |
| --- | --- |
| [`docs/ONLINE_SECTION.md`](docs/ONLINE_SECTION.md) | the extension window, sign-in, downloads/likes sync, and what the chrome bar shows |
| [`docs/INTEGRATION_CONTRACT.md`](docs/INTEGRATION_CONTRACT.md) | what the player requires from `dannify/`, how updates are staged and verified, and the release-asset problem |
| [`docs/YOUTUBE_PIPELINE.md`](docs/YOUTUBE_PIPELINE.md) | the browse/stream/sign-in flow of the older React port |

Updating the extension is one command — stage, verify, smoke-test, swap,
keep the old copy to roll back to:

```bash
python tools/update-dannify.py --from <folder-or-zip>
python tools/update-dannify.py --release v4.18.0
python tools/update-dannify.py --from <zip> --dry-run   # check only
```

---

## Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
