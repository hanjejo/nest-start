import { render, screen } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as unknown as typeof fetch;
  });

  it('renders brand and roster shell', async () => {
    render(<App />);
    expect(screen.getByText('NestStart')).toBeTruthy();
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
  });
});
