import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Convex's shortest supported interval is one minute.
crons.interval("poll folio worker", { seconds: 60 }, internal.worker.poll, {});

export default crons;
