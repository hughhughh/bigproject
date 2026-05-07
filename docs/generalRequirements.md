# General Requirements

This document captures reusable development standards that apply across projects.  
Keep this file general and avoid project-specific business logic or product details.

## Core Development Principles

- Build modularly and favor reusable components over one-off implementations.
- Prefer composition over duplication; extract shared UI and logic early.
- Keep files focused on a single responsibility.
- Make implementation decisions explicit and predictable.
- Ask for clarification when requirements are ambiguous instead of assuming.
- Build with both mobile and bigger screens in mind

## Tech Stack and Language Conventions

- Use TypeScript for both frontend and backend code when possible.
- Use a component-based UI framework and keep presentational code in components.
- Use utility-first or token-based styling consistently to keep design changes centralized.
- Keep environment configuration in environment variables; never hardcode secrets.
- Prefer server-side rendering for content that does not require client-only behavior.

## File and Folder Structure

- Keep route/page files thin: compose feature components rather than implementing heavy logic inline.
- Place reusable UI in a dedicated components folder (for example, `components/`).
- Keep shared business logic in a dedicated library/utilities folder (for example, `lib/` or `utils/`).
- Group feature-specific code by domain so related files stay close together.
- Use clear, consistent file naming conventions across the codebase.

## Component-First Build Guidelines

- Build features as small, composable components with well-defined props/interfaces.
- Keep components decoupled from data-fetching details unless they are container components.
- Separate presentation, state management, and data access when practical.
- Create shared primitives (buttons, inputs, cards, modals) before making custom one-off variants.
- Reuse existing components before introducing new ones.

## API and Data Practices

- Validate inputs at API boundaries.
- Keep data models typed and consistent across server and client boundaries.
- Isolate external integrations (auth, payments, AI providers, email, etc.) behind service helpers.
- Handle failures explicitly with user-safe errors and meaningful logs.
- Avoid writing unnecessary transient state to the database when client storage is sufficient.

## UX and Accessibility Baseline

- Design primarily for the target platform, but always support responsive behavior for smaller screens.
- Ensure readable typography, adequate spacing, and accessible color contrast.
- Provide keyboard-friendly interactions and visible focus states.
- Use semantic HTML and accessible labels for form controls and interactive elements.
- Prevent layout breakage from long text, overflow, and variable content sizes.

## Quality and Maintainability

- Add types for public interfaces and avoid `any` unless unavoidable.
- Keep functions small and intention-revealing.
- Add concise comments only where logic is non-obvious.
- Prefer predictable state flows and avoid deeply nested conditional UI logic.
- Refactor opportunistically when complexity starts to grow.

## Testing and Verification

- Test key user flows and edge cases before merging.
- Verify responsive behavior and theme variants (if supported, such as light/dark mode).
- Run linting/type checks/build checks only when asked, you may be prompted with something like "build for production", in which case build the project and make any necesarry tweaks to pass the build without changing functionality
- Treat build failures as blockers and resolve them before shipping.

## Documentation and Change Management

- Keep project context documentation updated as behavior evolves.
- Keep stable requirements docs focused and low churn.
- Document new environment variables and setup steps when introduced.
- Use clear commit messages that explain intent, not just file changes.
