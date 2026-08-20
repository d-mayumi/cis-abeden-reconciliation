import { isBasicAuthAuthorized } from './src/utils/basicAuth';

const unauthorizedResponse = () =>
  new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="CIS Abeden Reconciliation", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });

export const config = {
  matcher: '/(.*)',
};

export default function middleware(request: Request) {
  const authorized = isBasicAuthAuthorized(request.headers.get('authorization'), {
    BASIC_AUTH_USER: process.env.BASIC_AUTH_USER,
    BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD,
  });
  if (!authorized) {
    return unauthorizedResponse();
  }

  return undefined;
}
