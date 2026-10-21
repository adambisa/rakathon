interface DownloadTicket {
  url: string;
  expiresAt: string;
}

const REFRESH_MARGIN_MS = 30_000;

export const documentTicketCache = {
  gcTime: 10 * 60 * 1000,
  staleTime: ({ state }: { state: { data: DownloadTicket | undefined; dataUpdatedAt: number } }) => {
    if (state.data === undefined) return 0;

    return Math.max(0, Date.parse(state.data.expiresAt) - state.dataUpdatedAt - REFRESH_MARGIN_MS);
  },
  refetchInterval: ({ state }: { state: { data: DownloadTicket | undefined; status: string } }) => {
    if (state.data === undefined || state.status === "error") return false;

    return Math.max(1000, Date.parse(state.data.expiresAt) - Date.now() - REFRESH_MARGIN_MS);
  },
};

export function usableDocumentTicket(ticket: DownloadTicket | undefined): DownloadTicket | undefined {
  if (ticket === undefined || Date.parse(ticket.expiresAt) <= Date.now()) return undefined;

  return ticket;
}
