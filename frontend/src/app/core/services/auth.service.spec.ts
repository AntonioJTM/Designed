import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { SE_LLEVA_COSTO } from '../costos';

/**
 * La tienda no lleva el costo de lo que compra (core/costos.ts): mientras esté
 * apagado, «Ver costos y márgenes» no lo tiene nadie, ni el administrador, que
 * para todo lo demás lo puede todo.
 */
describe('AuthService.puede', () => {
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
  });

  it('el administrador lo puede todo, menos ver costos si la tienda no los lleva', () => {
    auth.sesion.set({ tipo: 'usuario', nombre: 'Admin', correo: 'a@a', rol: 'administrador', permisos: ['hacer:ver_costos'] });
    expect(auth.puede('hacer:cambiar_precios')).toBe(true);
    expect(auth.puede('ver:negocio')).toBe(true);
    expect(auth.puede('hacer:ver_costos')).toBe(SE_LLEVA_COSTO);
  });

  it('quien tiene el puesto de administrador ADEMÁS de otro lo puede todo', () => {
    auth.sesion.set({ tipo: 'usuario', nombre: 'Rosa', correo: 'r@r', rol: 'cajero', puestos: ['cajero', 'administrador'], permisos: [] });
    expect(auth.esAdmin()).toBe(true);
    expect(auth.puede('ver:nomina')).toBe(true);
  });

  it('con varios puestos sin administrador, solo lo que traen sus permisos sumados', () => {
    auth.sesion.set({ tipo: 'usuario', nombre: 'Toño', correo: 't@t', rol: 'cajero', puestos: ['cajero', 'almacenista'], permisos: ['ver:pos', 'ver:inventario'] });
    expect(auth.esAdmin()).toBe(false);
    expect(auth.puede('ver:inventario')).toBe(true);
    expect(auth.puede('ver:nomina')).toBe(false);
  });

  it('a un puesto con el permiso tampoco se lo da mientras no se lleve el costo', () => {
    auth.sesion.set({ tipo: 'usuario', nombre: 'Gerente', correo: 'g@g', rol: 'gerente', permisos: ['hacer:ver_costos', 'ver:negocio'] });
    expect(auth.puede('ver:negocio')).toBe(true);
    expect(auth.puede('hacer:ver_costos')).toBe(SE_LLEVA_COSTO);
  });
});
