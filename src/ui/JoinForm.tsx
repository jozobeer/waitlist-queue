type Props = {
  onJoin: (name: string) => void;
  submitting: boolean;
  error: string | null;
};

export function JoinForm({ onJoin, submitting, error }: Props) {
  return (
    <form
      className="join-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const input = form.elements.namedItem("name") as HTMLInputElement;
        onJoin(input.value);
      }}
    >
      <label htmlFor="name-input">お名前</label>
      <div className="join-row">
        <input
          id="name-input"
          name="name"
          data-testid="name-input"
          type="text"
          autoComplete="off"
          disabled={submitting}
          placeholder="表示名"
        />
        <button data-testid="join-button" type="submit" disabled={submitting}>
          参加する
        </button>
      </div>
      {error ? (
        <p role="alert" data-testid="form-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
