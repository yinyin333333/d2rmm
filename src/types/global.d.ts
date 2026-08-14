export {};

declare global {
  interface Window {
    env: {
      locale: string | null;
      platform: string;
      profileStartup: boolean;
    };
  }
}
