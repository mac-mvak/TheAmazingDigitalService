declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FAL_KEY?: string;
    XAI_API_KEY?: string;
  }
}
