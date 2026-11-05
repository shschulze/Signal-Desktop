// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as sinon from 'sinon';
import { session } from 'electron';
import { v4 as uuid } from 'uuid';

import { updateDefaultSession } from '../../../app/updateDefaultSession.main.ts';

describe('updateDefaultSession', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('does not configure a Hunspell dictionary source', () => {
    const sesh = session.fromPartition(uuid());
    const stub = sandbox.stub(sesh, 'setSpellCheckerDictionaryDownloadURL');

    const logger = {
      fatal: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
      info: sandbox.stub(),
      debug: sandbox.stub(),
      trace: sandbox.stub(),
      child: sandbox.stub(),
    };
    updateDefaultSession(sesh, logger);

    sinon.assert.notCalled(stub);
    sinon.assert.notCalled(logger.fatal);
    sinon.assert.notCalled(logger.error);
    sinon.assert.notCalled(logger.warn);
  });
});
