// A rejected token (expired, or the api restarted with new keys) signs the person out. Every
// call but the sign-in ones is wrapped; each wrapper is made once so callers see stable functions.
type Call = (...args: unknown[]) => unknown;

export function guarded<T extends object>(
  api: T,
  signOut: () => void,
  isUnauthorised: (error: unknown) => boolean,
  unguarded: readonly string[] = ["signIn", "testSignIn", "answerChallenge"],
): T {
  const wrappers = new Map<PropertyKey, Call>();
  return new Proxy(api, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof value !== "function" || (typeof name === "string" && unguarded.includes(name))) {
        return value;
      }
      let wrapper = wrappers.get(name);
      if (!wrapper) {
        const call = value as Call;
        wrapper = async (...args: unknown[]) => {
          try {
            return await call(...args);
          } catch (error) {
            if (isUnauthorised(error)) signOut();
            throw error;
          }
        };
        wrappers.set(name, wrapper);
      }
      return wrapper;
    },
  });
}
