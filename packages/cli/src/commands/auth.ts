import { AngelOneProvider } from '@stark/core/api/angel-one.js';
import { loadConfig } from '@stark/core/config/index.js';
import { generateTOTP } from '@stark/core/auth/index.js';

export async function authCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  if (!config.angelOne?.apiKey) {
    console.error('Error: Angel One API key not configured.');
    console.error('Set it in ~/.stark/config.json under "angelOne.apiKey"');
    process.exit(1);
  }

  const provider = new AngelOneProvider(config.angelOne.apiKey);

  if (provider.isAuthenticated() && !args.includes('--force')) {
    console.log('Already authenticated for today.');
    console.log('Use --force to re-authenticate.');
    return;
  }

  // Auto mode: generate TOTP from config
  if (args.includes('--auto')) {
    if (!config.angelOne.totpSecret) {
      console.error('Error: No TOTP secret configured.');
      console.error('Add "totpSecret" to angelOne config in ~/.stark/config.json');
      console.error('Example: { "angelOne": { "totpSecret": "YOUR_BASE32_SECRET" } }');
      process.exit(1);
    }

    const clientCode = config.angelOne.clientId ?? process.env.ANGEL_CLIENT_CODE;
    const password = process.env.ANGEL_PASSWORD;

    if (!clientCode || !password) {
      console.error('Error: --auto requires clientId in config and ANGEL_PASSWORD env var');
      process.exit(1);
    }

    try {
      const totp = generateTOTP(config.angelOne.totpSecret);
      console.log('Generated TOTP automatically');
      await provider.authenticate({ clientcode: clientCode, password, totp });
      console.log('Authentication successful!');
      console.log('Session token stored at ~/.stark/session.json');
    } catch (err) {
      console.error('Auto-authentication failed:', (err as Error).message);
      process.exit(1);
    }
    return;
  }

  // Manual mode
  const clientCode =
    process.env.ANGEL_CLIENT_CODE ??
    args.find((a) => a.startsWith('--client='))?.split('=')[1];
  const password =
    process.env.ANGEL_PASSWORD ??
    args.find((a) => a.startsWith('--password='))?.split('=')[1];
  const totp =
    process.env.ANGEL_TOTP ??
    args.find((a) => a.startsWith('--totp='))?.split('=')[1];

  if (!clientCode || !password || !totp) {
    console.error(
      'Usage: stark auth --client=<code> --password=<pwd> --totp=<totp>',
    );
    console.error('       stark auth --auto  (uses totpSecret from config)');
    console.error(
      'Or set ANGEL_CLIENT_CODE, ANGEL_PASSWORD, ANGEL_TOTP env vars',
    );
    process.exit(1);
  }

  try {
    await provider.authenticate({ clientcode: clientCode, password, totp });
    console.log('Authentication successful!');
    console.log('Session token stored at ~/.stark/session.json');
  } catch (err) {
    console.error('Authentication failed:', (err as Error).message);
    process.exit(1);
  }
}
