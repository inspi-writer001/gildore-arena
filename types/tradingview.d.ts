declare global {
  interface Window {
    TradingView?: {
      widget: new (options: Record<string, unknown>) => {
        onChartReady: (callback: () => void) => void;
        activeChart: () => {
          removeAllShapes?: () => void | Promise<void>;
          createShape?: (
            point: { time: number; price?: number },
            options: Record<string, unknown>,
          ) => Promise<unknown>;
          createMultipointShape?: (
            points: Array<{ time: number; price?: number }>,
            options: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        remove?: () => void;
      };
    };
    Datafeeds?: {
      UDFCompatibleDatafeed: new (
        datafeedUrl: string,
        updateFrequency?: number,
      ) => unknown;
    };
  }
}

export {};
