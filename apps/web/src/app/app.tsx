import { FormEvent, useEffect, useState, useTransition } from 'react';
import { createUser, listUsers, User } from '../api/users';
import styles from './app.module.css';

export function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    listUsers()
      .then((data) => {
        if (alive) setUsers(data);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || 'Failed to load users');
      });
    return () => {
      alive = false;
    };
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    startTransition(async () => {
      try {
        const created = await createUser({ name: name.trim(), email: email.trim() });
        setUsers((prev) => [created, ...prev]);
        setName('');
        setEmail('');
        setMessage(`Added ${created.name}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Create failed');
      }
    });
  }

  return (
    <main className={styles.shell}>
      <p className={styles.brand}>NestStart</p>
      <h1 className={styles.headline}>People on the wire.</h1>
      <p className={styles.lede}>
        Add a teammate through the Nest API and watch the roster update live.
      </p>

      <form className={styles.compose} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span>Name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
            required
            data-testid="name-input"
          />
        </label>
        <label className={styles.field}>
          <span>Email</span>
          <input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ada@analytical.engine"
            required
            data-testid="email-input"
          />
        </label>
        <button className={styles.submit} type="submit" disabled={pending} data-testid="submit-user">
          {pending ? 'Saving…' : 'Add person'}
        </button>
      </form>

      <p
        className={styles.status}
        data-tone={error ? 'error' : undefined}
        data-testid="status"
      >
        {error || message}
      </p>

      <section className={styles.people} aria-live="polite">
        <h2>Roster</h2>
        {users.length === 0 ? (
          <p className={styles.empty} data-testid="empty-state">
            No people yet. Add the first one above.
          </p>
        ) : (
          <ul data-testid="user-list">
            {users.map((user) => (
              <li key={user.id} data-testid="user-row">
                <span className={styles.name}>{user.name}</span>
                <span className={styles.email}>{user.email}</span>
                <span className={styles.when}>{user.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
