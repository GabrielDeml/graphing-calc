import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Run `pnpm icons` once after changing public/logo.svg; the generated PNG/ICO files are committed.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#2d70b3' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#2d70b3' } },
  },
  images: ['public/logo.svg'],
});
