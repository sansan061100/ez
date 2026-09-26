import pluginVue from 'eslint-plugin-vue';
import vueTsEslintConfig from '@vue/eslint-config-typescript';

export default [
    ...pluginVue.configs['flat/essential'],
    ...vueTsEslintConfig(),
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['vitest.config.ts']
                },
                tsconfigRootDir: import.meta.dirname,
            }
        },
    },
    {
        ignores: [
            '.nuxt/**',
            '.output/**',
            '**/*.{js,jsx,cjs,mjs}'
        ]
    },
    {
        files: [
            '**/*.{vue,ts,tsx,mts,js,jsx,cjs,mjs}'
        ],
        rules: {
            'vue/valid-v-slot': ['error', {
                allowModifiers: true
            }]
        }
    },
    {
        // the names of the nuxt pages and layouts are their file names
        files: [
            'app/app.vue',
            'app/pages/**/*.vue',
            'app/layouts/**/*.vue'
        ],
        rules: {
            'vue/multi-word-component-names': 'off'
        }
    },
    {
        // the server code uses the underscore prefix for the intentionally unused parameters
        files: [
            'server/**/*.ts'
        ],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_'
            }]
        }
    },
];
