import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatePanel } from './StatePanel';

describe('StatePanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correctly with title and message', () => {
    render(<StatePanel title="No Contacts" message="Your contact list is empty." />);
    expect(screen.getByText('No Contacts')).toBeInTheDocument();
    expect(screen.getByText('Your contact list is empty.')).toBeInTheDocument();
  });

  it('renders with icon', () => {
    render(
      <StatePanel 
        title="Error" 
        message="An error occurred" 
        icon={<span data-testid="error-icon" />} 
      />
    );
    expect(screen.getByTestId('error-icon')).toBeInTheDocument();
  });

  it('renders with action', () => {
    render(
      <StatePanel 
        title="Empty" 
        message="List is empty" 
        action={<button>Add Contact</button>} 
      />
    );
    expect(screen.getByRole('button', { name: 'Add Contact' })).toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    const { container } = render(<StatePanel title="Loading" message="Please wait..." />);
    const panel = container.firstChild as HTMLElement;
    expect(panel).toHaveAttribute('role', 'status');
    expect(panel).toHaveAttribute('aria-live', 'polite');
  });
});
