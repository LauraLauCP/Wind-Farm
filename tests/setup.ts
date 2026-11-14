// Test-suite defaults: the tests never hit the real AEMET API, so any key
// works. dotenv does not override variables that are already set, so these
// defaults also win over a developer's local .env during `npm test`.
process.env.AEMET_API_KEY ??= 'test-api-key';
process.env.AEMET_BASE_URL ??= 'https://aemet.example.test/opendata/api';
process.env.PORT ??= '3000'; // Tests never listen on a port (supertest), the value is irrelevant.
