import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('ypal-old-runtime-inventory-v1.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class SocketOwnership(unittest.TestCase):
    def rows(self):
        return [{'pid': 1001, 'backendStart': '2026-10-23T00:00:00Z', 'clientAddress': None, 'clientPort': -1},
                {'pid': 1002, 'backendStart': '2026-10-23T01:00:00Z', 'clientAddress': '127.0.0.1', 'clientPort': 50000}]

    def test_real_ss_unix_column_shape_and_disjoint_socket_ownership(self):
        peers = m.unix_peers(b'u_str ESTAB 0 0 * 10 /var/run/postgresql/.s.PGSQL.5432 20\n')
        self.assertEqual(peers, {10: 20})
        result = m.map_owned_backends({'7': {'socketInodes': [10, 900]}},
            {'1001': {'socketInodes': [20]}, '1002': {'socketInodes': [30]}}, self.rows(), peers, {})
        self.assertEqual(result, [{'pid': 1001, 'backendStart': '2026-10-23T00:00:00Z', 'transport': 'unix-peer-inode'}])

    def test_same_application_or_age_without_socket_match_never_attributes(self):
        rows = self.rows()
        for row in rows: row.update(applicationName='ponder', backendStart='same-time')
        self.assertEqual(m.map_owned_backends({'7': {'socketInodes': [999]}},
            {'1001': {'socketInodes': [20]}, '1002': {'socketInodes': [30]}}, rows, {10: 20}, {}), [])

    def test_exact_tcp_client_endpoint_matches_owned_fd_only(self):
        line = b'header\n0: 0100007F:C350 0100007F:1538 01 0:0 0:0 0 970 0 77\n'
        tcp = m.tcp_clients(line)
        self.assertEqual(tcp[77]['clientAddress'], '127.0.0.1')
        result = m.map_owned_backends({'7': {'socketInodes': [77]}},
            {'1001': {'socketInodes': []}, '1002': {'socketInodes': []}}, self.rows(), {}, tcp)
        self.assertEqual(result[0]['pid'], 1002)
        self.assertEqual(m.map_owned_backends({'7': {'socketInodes': []}},
            {'1001': {'socketInodes': []}, '1002': {'socketInodes': []}}, self.rows(), {}, tcp), [])

    def test_tcp6_kernel_word_order_and_nonpostgres_connection_exclusion(self):
        raw = b'header\n0: 00000000000000000000000001000000:C350 00000000000000000000000001000000:1538 01 0:0 0:0 0 970 0 77\n'
        self.assertEqual(m.tcp_clients(raw, True)[77]['clientAddress'], '::1')
        self.assertEqual(m.tcp_clients(raw.replace(b':1538', b':4B02'), True), {})

    def test_ambiguous_peer_or_backend_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'ambiguous_unix'):
            m.unix_peers(b'u_str ESTAB 0 0 * 10 * 20\nu_str ESTAB 0 0 * 10 * 30\n')
        with self.assertRaisesRegex(RuntimeError, 'ambiguous_owned_source_backend'):
            m.map_owned_backends({'7': {'socketInodes': [10]}},
                {'1001': {'socketInodes': [20]}, '1002': {'socketInodes': [20]}}, self.rows(), {10: 20}, {})

    def test_duplicate_backend_and_double_socket_alias_refuse(self):
        with self.assertRaisesRegex(RuntimeError, 'bounded_unique'):
            m.map_owned_backends({}, {}, [self.rows()[0], self.rows()[0]], {}, {})
        with self.assertRaisesRegex(RuntimeError, 'duplicate_owned_backend_socket'):
            m.map_owned_backends({'7': {'socketInodes': [10, 11]}},
                {'1001': {'socketInodes': [20]}, '1002': {'socketInodes': [30]}}, self.rows(), {10: 20, 11: 20}, {})


if __name__ == '__main__': unittest.main()
