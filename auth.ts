import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { ObjectId } from "mongodb";
import mongoAdapterClient, { getDb, getDbName } from "@/lib/mongodb";

const googleConfigured =
  Boolean(process.env.AUTH_GOOGLE_ID) && Boolean(process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(mongoAdapterClient, { databaseName: getDbName() }),
  session: { strategy: "jwt" },
  providers: [
    ...(googleConfigured
      ? [
          Google({
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    Credentials({
      id: "email-code",
      name: "Email one-time code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toString().trim().toLowerCase();
        const code = credentials?.code?.toString().trim();
        if (!email || !code) return null;

        const db = await getDb();
        const row = await db.collection("login_codes").findOne({ email });
        if (!row || typeof row.code !== "string") return null;
        if (row.code !== code) return null;
        if (!(row.expiresAt instanceof Date) || row.expiresAt < new Date()) {
          return null;
        }
        await db.collection("login_codes").deleteOne({ _id: row._id });

        const users = db.collection("users");
        let user = await users.findOne<{ _id: ObjectId; email: string; name?: string | null }>(
          { email },
        );
        if (!user) {
          const inserted = await users.insertOne({
            email,
            emailVerified: new Date(),
            name: email.split("@")[0],
          });
          user = { _id: inserted.insertedId, email, name: email.split("@")[0] };
        }

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name ?? email.split("@")[0],
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
});
