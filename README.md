<!-- Copyright 2014 Signal Messenger, LLC -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Signal Desktop

Signal Desktop links with Signal on [Android](https://github.com/signalapp/Signal-Android) or [iOS](https://github.com/signalapp/Signal-iOS) and lets you message from your Windows, macOS, and Linux computers.

[Install the production version](https://signal.org/download/) or help us out by [installing the beta version](https://support.signal.org/hc/articles/360007318471-Signal-Beta).

## About this fork

> **This is a personal fork, not an official Signal release.** It is not
> affiliated with or endorsed by Signal Messenger.

This fork **replaces the built-in spellchecker** — Chromium's Hunspell-based one,
which downloaded dictionary files from Signal's servers — **with
[LanguageTool](https://languagetool.org/)**, which checks spelling, grammar and
style in the message composition box.

LanguageTool is not bundled. To use it you must run your own
[LanguageTool server](https://dev.languagetool.org/http-server) and point Signal
at it under **Settings → Chats → LanguageTool server**; until you do, no spell
checking happens at all. The language is detected from the text you type and can
be overridden from the suggestion popup.

Drafts are only sent to the server you configure, and the public LanguageTool API
is not used by default — but note that if you point this at a remote server,
**message text you are composing leaves your device**. Use a server you control.

## Got a question?

You can find answers to a number of frequently asked questions on our [support site](https://support.signal.org/).
The [community forum](https://community.signalusers.org/) is another good place for questions.

## Found a Bug?

Please search for any [existing issues](https://github.com/signalapp/Signal-Desktop/issues) that describe your bug in order to avoid duplicate submissions.

## Have a feature request, question, comment?

Please use our community forum: https://community.signalusers.org/

## Contributing to the project

Please see [CONTRIBUTING.md](https://github.com/signalapp/Signal-Desktop/blob/main/CONTRIBUTING.md). There are lots of ways to contribute - many that don't involve code!

## Donate to Signal

You can donate to Signal from inside Signal apps (Desktop, Android, or iOS), or via the web here: [Signal Technology Foundation](https://signal.org/donate). Signal is an independent 501c3 nonprofit.

## Cryptography Notice

This distribution includes cryptographic software. The country in which you currently reside may have restrictions on the import, possession, use, and/or re-export to another country, of encryption software.
BEFORE using any encryption software, please check your country's laws, regulations and policies concerning the import, possession, or use, and re-export of encryption software, to see if this is permitted.
See <http://www.wassenaar.org/> for more information.

The U.S. Government Department of Commerce, Bureau of Industry and Security (BIS), has classified this software as Export Commodity Control Number (ECCN) 5D002.C.1, which includes information security software using or performing cryptographic functions with asymmetric algorithms.
The form and manner of this distribution makes it eligible for export under the License Exception ENC Technology Software Unrestricted (TSU) exception (see the BIS Export Administration Regulations, Section 740.13) for both object code and source code.

## License

Copyright 2013-2024 Signal Messenger, LLC

Licensed under the GNU AGPLv3: https://www.gnu.org/licenses/agpl-3.0.html
