"""Financial invariants and authority boundaries of automatic reviews."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reviews.domain import ReviewError, plan_review


def fixture():
    movement = {'id': 'm', 'id_propietario': 'u', 'tipo': 'gasto', 'concepto': 'Compra', 'importe': 30, 'hucha_id': 'old', 'fecha_operacion': '2026-03-02', 'review_version': 2}
    proposal = {'name': 'Pedido', 'category': 'food', 'reason': 'Recibo del comercio', 'expected_version': 2, 'configuration_revision': 1, 'operation_id': 'op'}
    categories = [{'id': 'food', 'tipo': 'gasto', 'label': 'Comida'}]
    huchas = {hid: {'id_propietario': 'u', 'saldo_acumulado': 50, 'activa': True} for hid in ('old', 'new', 'rest')}
    huchas['rest']['tipo_aportacion'] = 'resto'
    return [movement, proposal, categories, huchas, {'revision': 1, 'category_huchas': {'food': 'new'}}, {}, {}]


def plan(args):
    return plan_review('u', *args)


def assert_error(args, code):
    with pytest.raises(ReviewError) as exc:
        plan(args)
    assert exc.value.code == code


def test_reassignment_uses_gross_amount_and_preserves_compensations_and_inputs():
    args = fixture()
    args[0].update(importe_neto=10, compensado_por=['income'])
    result = plan(args)
    assert result['hucha_deltas'] == {'new': -3000, 'old': 3000}
    assert result['movement_changes'] == {'concepto': 'Pedido', 'categoria': 'food', 'hucha_id': 'new'}
    assert args[0]['concepto'] == 'Compra'
    assert args[0]['compensado_por'] == ['income']


def test_caps_redirect_without_losing_money():
    args = fixture()
    args[3]['old'].update(tope_objetivo=True, objetivo=60)
    assert plan(args)['hucha_deltas'] == {'new': -3000, 'old': 1000, 'rest': 2000}
    args[3]['rest'].update(tope_objetivo=True, objetivo=50)
    assert_error(args, 'unallocated_overflow')


def test_overflow_into_charged_destination_accounts_for_new_room():
    args = fixture()
    args[3]['old'].update(tope_objetivo=True, objetivo=50)
    args[3]['rest'].pop('tipo_aportacion')
    args[3]['new'].update(tope_objetivo=True, objetivo=50, tipo_aportacion='resto')
    assert plan(args)['hucha_deltas'] == {}
    assert plan(args)['movement_changes']['hucha_id'] == 'new'


@pytest.mark.parametrize('field,value,code', [('importe', 20, 'forbidden_fields'), ('expected_version', 1, 'version_conflict'), ('configuration_revision', 0, 'configuration_conflict')])
def test_stale_and_forbidden_proposals(field, value, code):
    args = fixture()
    args[1][field] = value
    assert_error(args, code)


def test_manual_locks_and_legacy_confirmed_category():
    args = fixture()
    args[0]['review_protected_fields'] = ['hucha_id']
    assert plan(args)['hucha_deltas'] == {}
    args[0]['categoria'] = 'old_category'
    assert_error(args, 'manual_field')
    args[0]['field_provenance'] = {'categoria': {'source': 'automatic'}}
    assert plan(args)['movement_changes']['categoria'] == 'food'
    args[0]['review_protected_fields'].append('concepto')
    assert_error(args, 'manual_field')


@pytest.mark.parametrize('field,value,code', [('deuda_pendiente', 10, 'unsupported_debt'), ('activa', False, 'invalid_hucha'), ('id_propietario', 'other', 'forbidden')])
def test_invalid_destination(field, value, code):
    args = fixture()
    args[3]['new'][field] = value
    assert_error(args, code)


def subscription_fixture():
    args = fixture()
    args[1]['new_subscription'] = {'name': 'Servicio', 'amount': 19.25, 'frequency': 'monthly', 'day': 7, 'anchor_date': '2026-01-07', 'reason': 'Facturas mensuales del servicio', 'evidence_movement_ids': ['a', 'b', 'm']}
    args[6] = {mid: {'id_propietario': 'u', 'tipo': 'gasto', 'importe': amount, 'fecha_operacion': dt} for mid, amount, dt in [('a', 10, '2025-12-31T23:15:00Z'), ('b', 15, '2026-02-05')]}
    args[6]['m'] = args[0]
    return args


def test_subscription_months_use_madrid_and_allow_varying_days_amounts():
    args = subscription_fixture()
    result = plan(args)
    sub = result['new_subscription']
    assert sub['frecuencia'] == 'mensual'
    assert sub['importe'] == 19.25
    assert result['subscription_changes'] == {mid: {'suscripcion_id': sub['id']} for mid in ('a', 'b', 'm')}
    assert plan(args)['new_subscription']['id'] == sub['id']


@pytest.mark.parametrize('mutation,code', [('duplicate', 'invalid_evidence'), ('gap', 'insufficient_months'), ('foreign', 'forbidden'), ('linked', 'subscription_conflict'), ('internal', 'invalid_evidence'), ('currency', 'currency_conflict'), ('annual', 'invalid_frequency')])
def test_subscription_structural_evidence_validation(mutation, code):
    args = subscription_fixture()
    if mutation == 'duplicate':
        args[1]['new_subscription']['evidence_movement_ids'] = ['a', 'a', 'b']
    elif mutation == 'gap':
        args[6]['m']['fecha_operacion'] = '2026-04-07'
    elif mutation == 'foreign':
        args[6]['a']['id_propietario'] = 'other'
    elif mutation == 'linked':
        args[6]['a']['suscripcion_id'] = 'existing'
    elif mutation == 'internal':
        args[6]['a']['es_interno'] = True
    elif mutation == 'currency':
        args[6]['a']['moneda'] = 'USD'
    else:
        args[1]['new_subscription']['frequency'] = 'annual'
    assert_error(args, code)


def test_existing_subscription_hucha_precedence_and_no_schedule_mutation():
    args = fixture()
    args[1]['subscription_id'] = 's'
    args[5]['s'] = {'id_propietario': 'u', 'hucha_id': 'rest', 'importe': 80, 'dia_pago': 10, 'frecuencia': 'anual'}
    assert plan(args)['movement_changes']['hucha_id'] == 'new'
    args[4]['category_huchas'] = {}
    result = plan(args)
    assert result['movement_changes']['hucha_id'] == 'rest'
    assert result['subscription_changes'] == {}
    assert args[5]['s']['importe'] == 80


def test_income_classification_never_redistributes_money():
    args = fixture()
    args[0]['tipo'] = 'ingreso'
    args[2][0]['tipo'] = 'ingreso'
    assert plan(args)['hucha_deltas'] == {}


def test_new_subscription_hucha_and_system_budget_sync():
    args = subscription_fixture()
    args[3]['rest']['es_suscripciones'] = True
    assert plan(args)['new_subscription']['hucha_id'] == 'new'
    assert plan(args)['hucha_changes'] == {}
    args[4]['category_huchas'] = {}
    args[5] = {'annual': {'id_propietario': 'u', 'frecuencia': 'anual', 'importe': 120, 'activa': True}, 'shared': {'id_propietario': 'u', 'frecuencia': 'mensual', 'importe': 20, 'mi_parte': 5, 'activa': True}, 'outside': {'id_propietario': 'u', 'frecuencia': 'mensual', 'importe': 99, 'hucha_id': 'old', 'activa': True}}
    result = plan(args)
    assert result['new_subscription']['hucha_id'] == 'rest'
    assert result['movement_changes']['hucha_id'] == 'rest'
    assert result['hucha_changes']['rest']['valor_aportacion'] == 34.25
    args[3]['rest'].pop('es_suscripciones')
    result = plan(args)
    assert result['new_subscription']['hucha_id'] == 'old'
    assert result['hucha_changes'] == {}


def test_creation_requires_current_movement_and_supported_currency():
    args = subscription_fixture()
    args[1]['new_subscription']['evidence_movement_ids'][-1] = 'other'
    assert_error(args, 'invalid_evidence')
    args = subscription_fixture()
    args[0]['moneda'] = 'USD'
    assert_error(args, 'unsupported_currency')
