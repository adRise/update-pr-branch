const js = require('@eslint/js');
const jest = require('eslint-plugin-jest');
const globals = require('globals');

module.exports = [
  {
    plugins: {
      jest,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      ecmaVersion: 2018,
    },
    rules: js.configs.recommended.rules,
  },
];
