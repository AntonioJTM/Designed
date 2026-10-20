import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Login } from './login';
import { AuthService } from '../../core/services/auth.service';

/**
 * Entrar (2026-10-20, usuario): la contraseña lleva su ojito para revisar lo que
 * se escribió. Lo enseña, lo vuelve a tapar y no intenta entrar.
 */
describe('Login', () => {
  let intentos = 0;

  async function montar() {
    intentos = 0;
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { login: () => { intentos++; throw new Error('no debía entrar'); } } },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(Login);
    f.detectChanges();
    return f;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('el ojito enseña la contraseña escrita, la vuelve a tapar y no intenta entrar', async () => {
    const f = await montar();
    const el = f.nativeElement as HTMLElement;
    const input = el.querySelector('#login-contrasena') as HTMLInputElement;
    const ojo = el.querySelector('.ojo') as HTMLButtonElement;
    f.componentInstance.form.patchValue({ correo: 'ana@tienda.mx', contrasena: 'Hilos2026!' });
    expect(input.type).toBe('password');
    expect(ojo.getAttribute('aria-label')).toBe('Ver la contraseña');
    ojo.click();
    f.detectChanges();
    expect(input.type).toBe('text');
    expect(ojo.getAttribute('aria-pressed')).toBe('true');
    ojo.click();
    f.detectChanges();
    expect(input.type).toBe('password');
    expect(intentos).toBe(0);
  });

  it('el campo se sigue llamando "Contraseña" para el lector de pantalla', async () => {
    const f = await montar();
    const label = (f.nativeElement as HTMLElement).querySelector('label[for="login-contrasena"]');
    expect(label?.textContent?.trim()).toBe('Contraseña');
  });
});
