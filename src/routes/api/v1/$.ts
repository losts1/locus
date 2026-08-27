import { createFileRoute } from "@tanstack/react-router";
import { handleLocus } from "@/lib/memory/http.server";

const handle = ({ request }: { request: Request }) => handleLocus(request);

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
});
