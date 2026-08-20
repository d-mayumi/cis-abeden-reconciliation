export type BasicAuthEnv = {
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASSWORD?: string;
};

const decodeBase64 = (value: string) => {
  try {
    return atob(value);
  } catch {
    return '';
  }
};

export const isBasicAuthAuthorized = (authorizationHeader: string | null, env: BasicAuthEnv) => {
  const expectedUser = env.BASIC_AUTH_USER?.trim();
  const expectedPassword = env.BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPassword || !authorizationHeader?.startsWith('Basic ')) {
    return false;
  }

  const encodedCredentials = authorizationHeader.slice('Basic '.length).trim();
  const separatorIndex = decodeBase64(encodedCredentials).indexOf(':');
  const decodedCredentials = decodeBase64(encodedCredentials);

  if (separatorIndex < 0) {
    return false;
  }

  const user = decodedCredentials.slice(0, separatorIndex);
  const password = decodedCredentials.slice(separatorIndex + 1);

  return user === expectedUser && password === expectedPassword;
};
