import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { restore } from './support/map-environment.mjs';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Button } from '../components/ui/button';

afterEach(cleanup);
after(restore);

test('React18 Button forwards a ref to its DOM button', () => {
  const ref = React.createRef<HTMLButtonElement>();
  const view = render(<Button ref={ref}>Action</Button>);
  assert.equal(ref.current, view.getByRole('button'));
});

test('React18 Button forwards a ref through the asChild Slot', () => {
  const ref = React.createRef<HTMLButtonElement>();
  const view = render(<Button ref={ref} asChild><button>Child</button></Button>);
  assert.equal(ref.current, view.getByRole('button'));
});
