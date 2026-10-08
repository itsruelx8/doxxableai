'use strict';
/**
 * Hard-coded sample results for GET /api/demo, so the demo works offline.
 * The identities are fictional ("neo_demo"); the score is computed by the
 * real score engine so it always stays consistent with the scoring rules.
 */
const DEMO_RESULTS = [
  {
    id: 'breach',
    title: 'Data breaches',
    status: 'risk',
    points: 47,
    summary: 'Found in 4 known breaches - including sensitive data (Passwords, Phone numbers).',
    details: [
      'Breach: Canva',
      'Breach: LinkedIn',
      'Breach: Dropbox',
      'Breach: MyFitnessPal',
      'Exposed data types: Email addresses, Passwords, Names, Phone numbers, Usernames',
    ],
    fix: [
      'Change the password on every listed site and anywhere you reused it',
      'Enable 2FA / passkeys',
      'Use a password manager to make unique passwords',
      'Watch for phishing mails referencing these services',
    ],
  },
  {
    id: 'github',
    title: 'GitHub email exposure',
    status: 'risk',
    points: 15,
    summary: 'Your email is publicly visible on GitHub - anyone can harvest it from commit metadata.',
    details: ['Public commits in: neo-demo/dotfiles', 'Public commits in: neo-demo/hackathon-2024', '37 public commits authored with this email'],
    fix: [
      "Enable 'Keep my email addresses private' in GitHub Settings > Emails",
      "Turn on 'Block command line pushes that expose my email'",
      'Use your GitHub noreply address in git config user.email',
      'Rewrite history only if truly necessary',
    ],
  },
  {
    id: 'username',
    title: 'Username footprint',
    status: 'risk',
    points: 12,
    summary: 'This username exists on 6 platforms - easy to link your accounts together.',
    details: [
      'GitHub - https://github.com/neo_demo',
      'DEV Community - https://dev.to/neo_demo',
      'Chess.com - https://www.chess.com/member/neo_demo',
      'Docker Hub - https://hub.docker.com/u/neo_demo',
      'Keybase - https://keybase.io/neo_demo',
      'Hugging Face - https://huggingface.co/neo_demo',
      'Checked 16 sites, 1 inconclusive (Replit)',
    ],
    fix: [
      'Use different usernames for personal vs. professional accounts',
      'Delete accounts you no longer use',
      'Make old profiles private or remove personal info from bios',
    ],
  },
];

module.exports = { DEMO_RESULTS };
