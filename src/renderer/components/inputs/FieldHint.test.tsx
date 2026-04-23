import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldHint } from './FieldHint';

describe('FieldHint', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correctly with children', () => {
    render(<FieldHint id="hint-id">This is a hint</FieldHint>);
    const hintElement = screen.getByText('This is a hint');
    expect(hintElement).toBeInTheDocument();
    expect(hintElement).toHaveAttribute('id', 'hint-id');
  });

  it('renders nothing when no children are provided', () => {
    const { container } = render(<FieldHint id="hint-id">{null}</FieldHint>);
    expect(container.firstChild).toBeNull();
  });
});
