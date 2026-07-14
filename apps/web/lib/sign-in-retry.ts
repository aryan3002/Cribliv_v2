type SignInResult = { error?: string | null } | undefined;
type CredentialsSignIn<TResult extends SignInResult> = (
  provider: "credentials",
  options: Record<string, unknown>
) => Promise<TResult>;

const waitForCsrfCookie = () => new Promise<void>((resolve) => setTimeout(resolve, 120));

export async function signInWithCsrfRetry<TResult extends SignInResult>(
  signIn: CredentialsSignIn<TResult>,
  credentials: Record<string, unknown>,
  delay: () => Promise<void> = waitForCsrfCookie
): Promise<TResult> {
  const options = { redirect: false, ...credentials };
  let result = await signIn("credentials", options);

  if (result?.error === "MissingCSRF") {
    await delay();
    result = await signIn("credentials", options);
  }

  return result;
}
