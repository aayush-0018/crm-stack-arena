-- 018_table_rounds_and_traitor.sql — table-only quiz rounds, and the Traitor party game.
-- Additive: existing rounds stay all-tables rounds.

-- ---------------------------------------------------------------------------
-- A quiz round for one table only (NULL = all tables). One round at a time per table, and one
-- all-tables round at a time per branch. Only all-tables rounds with players from two or more
-- tables give a prize.
-- ---------------------------------------------------------------------------
ALTER TABLE game_rounds ADD COLUMN table_id BIGINT REFERENCES dining_tables(id) ON DELETE CASCADE;
CREATE INDEX game_rounds_table_idx ON game_rounds (table_id, ends_at DESC) WHERE table_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Traitor: a party game for the people at one table. Everyone gets the secret word except the
-- traitor, who only gets the category. They talk it over, vote, and the traitor is revealed.
-- ---------------------------------------------------------------------------
CREATE TABLE party_games (
  id                  BIGSERIAL   PRIMARY KEY,
  shop_id             BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  table_id            BIGINT      NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  -- Set when the cards are dealt.
  category            TEXT,
  word                TEXT,
  dealt_at            TIMESTAMPTZ,
  revealed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (revealed_at IS NULL OR dealt_at IS NOT NULL)
);
CREATE INDEX party_games_table_idx ON party_games (table_id, created_at DESC);

CREATE TABLE party_players (
  id               BIGSERIAL   PRIMARY KEY,
  game_id          BIGINT      NOT NULL REFERENCES party_games(id) ON DELETE CASCADE,
  guest_session_id BIGINT      NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  customer_id      BIGINT      NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  traitor          BOOLEAN     NOT NULL DEFAULT false,
  -- Who this player thinks the traitor is; can change until the reveal.
  vote_for         BIGINT      REFERENCES party_players(id) ON DELETE SET NULL,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, customer_id),
  CHECK (vote_for IS NULL OR vote_for <> id)
);
