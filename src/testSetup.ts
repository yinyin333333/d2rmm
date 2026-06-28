Object.defineProperty(window, 'env', {
  configurable: true,
  value: {
    platform: 'win32',
    profileStartup: false,
  },
});

beforeAll(async () => {
  const { initI18n } = await import('./renderer/i18n');
  await initI18n();
});
