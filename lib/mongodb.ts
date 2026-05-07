import { MongoClient } from "mongodb";

declare global {
  // eslint-disable-next-line no-var -- Next.js dev HMR singleton
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let prodClientPromise: Promise<MongoClient> | undefined;

export function getDbName(): string {
  return process.env.MONGODB_DB_NAME ?? "bigproject";
}

function connectPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return Promise.reject(new Error('Missing environment variable: "MONGODB_URI"'));
  }

  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      const client = new MongoClient(uri);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  }

  if (!prodClientPromise) {
    const client = new MongoClient(uri);
    prodClientPromise = client.connect();
  }
  return prodClientPromise;
}

/**
 * Auth.js adapter entry: a function returning a connected client (lazy; no connect at import time).
 */
export default function mongoAdapterClient() {
  return connectPromise();
}

export async function getDb() {
  const client = await connectPromise();
  return client.db(getDbName());
}
